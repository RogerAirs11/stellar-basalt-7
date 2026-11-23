import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProfileEditorController,
  buildProfileSubmission,
  consentWithdrawnElsewhere,
  diffProfileDraft,
  draftFromProfile,
  newDraft,
  summarizeClaims,
  type ProfileEditorDraft,
  type StoredProfile,
} from "../../src/frontend-kit/domain/profileEditor";
import { PlatformClientError } from "../../src/frontend-kit/errors";

/**
 * R98-N06 acceptance — the ONE headless profile-editor controller shared by
 * all five frontends. The five forms are independent VISUALS over this same
 * controller, so pinning it here pins every form:
 *
 *  1. An approved representative can publish, update, unpublish and revoke
 *     contact consent end to end (expected_version always populated from the
 *     stored row; first creation submits without it — the server's 428 gate
 *     is the proof).
 *  2. Editors without private-contact permission see no private draft: the
 *     contact field never enters the draft nor the submission.
 *  3. On 409 the controller fetches the current version, reports FIELD-LEVEL
 *     differences, retains the local draft and NEVER auto-resubmits a
 *     publication choice that was withdrawn on the server.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function storedProfile(overrides: Partial<StoredProfile> = {}): StoredProfile {
  return {
    person_id: 7, name_latin: "Azar Hosseini", name_native: "آذر حسینی", row_version: 3,
    service_categories: ["trainer"], province_code: "IR-08", province_code_raw: "IR-08", province_code_scheme: "IR-3166-2:2024", province_needs_review: false,
    city: "Tehran", contact_preference: "platform_message" as const, contact_value: "+98 21 000 0000",
    languages: "fa, en", availability_text: "Weekday mornings", publication_consent: true, published_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

const REPRESENTATIVE = { edit: true, initial_publication: true, private_contact: true };
const CURATOR = { edit: true, initial_publication: false, private_contact: false };

describe("N06 pure submission building — the five forms' shared core", () => {
  it("populates expected_version from the ACTUAL stored row_version on updates", () => {
    const draft = newDraft();
    const submission = buildProfileSubmission(draft, storedProfile({ row_version: 9 }), REPRESENTATIVE, "IR-3166-2:2024");
    expect(submission.expected_version).toBe(9);
  });

  it("first creation (no stored profile) submits WITHOUT expected_version — the 428 gate stays the proof", () => {
    const submission = buildProfileSubmission(newDraft(), null, REPRESENTATIVE, "IR-3166-2:2024");
    expect("expected_version" in submission).toBe(false);
  });

  it("sends the explicit province scheme whenever a province is set", () => {
    const draft = { ...newDraft(), province_code: "IR-08" };
    expect(buildProfileSubmission(draft, storedProfile(), REPRESENTATIVE, "IR-3166-2:2024").province_code_scheme).toBe("IR-3166-2:2024");
    const noProvince = { ...newDraft(), province_code: "" };
    expect(buildProfileSubmission(noProvince, storedProfile(), REPRESENTATIVE, "IR-3166-2:2024").province_code_scheme).toBeUndefined();
  });

  it("an editor WITHOUT private-contact permission never submits the private contact field", () => {
    const draft: ProfileEditorDraft = { ...newDraft(), contact_value: "+98 900 000 0000" };
    const submission = buildProfileSubmission(draft, storedProfile(), CURATOR, "IR-3166-2:2024");
    expect("contact_value" in submission).toBe(false);
    // With permission the value IS carried.
    expect(buildProfileSubmission(draft, storedProfile(), REPRESENTATIVE, "IR-3166-2:2024").contact_value).toBe("+98 900 000 0000");
  });

  it("the draft itself excludes private contact for non-permitted editors (nothing to render)", () => {
    const draft = draftFromProfile(storedProfile(), CURATOR);
    expect(draft.contact_value).toBe("");
    const representativeDraft = draftFromProfile(storedProfile(), REPRESENTATIVE);
    expect(representativeDraft.contact_value).toBe("+98 21 000 0000");
  });
});

describe("N06 conflict reconciliation — field-level diffs, retained drafts, no silent consent resubmission", () => {
  it("reports field-level differences between the local draft and the current server state", () => {
    const draft: ProfileEditorDraft = { ...newDraft(), city: "Karaj", availability_text: "Evenings", publication_consent: true };
    const server = storedProfile({ city: "Tehran", availability_text: "Evenings", publication_consent: false });
    const differences = diffProfileDraft(draft, server);
    const fields = differences.map((d) => d.field);
    expect(fields).toContain("city");
    expect(fields).toContain("publication_consent");
    expect(fields).not.toContain("availability_text"); // unchanged -> not reported
    const consent = differences.find((d) => d.field === "publication_consent")!;
    expect(consent.local).toBe("consented");
    expect(consent.server).toBe("withdrawn");
  });

  it("detects consent withdrawn elsewhere — the gate against auto-resubmission", () => {
    expect(consentWithdrawnElsewhere({ ...newDraft(), publication_consent: true }, storedProfile({ publication_consent: false }))).toBe(true);
    expect(consentWithdrawnElsewhere({ ...newDraft(), publication_consent: false }, storedProfile({ publication_consent: false }))).toBe(false);
    expect(consentWithdrawnElsewhere({ ...newDraft(), publication_consent: true }, storedProfile({ publication_consent: true }))).toBe(false);
  });
});

/** A minimal fake platform directory surface with scriptable behaviors. */
function fakeDirectoryPlatform(behavior: {
  managedProfile: () => Promise<unknown>;
  upsertProfile?: (input: unknown) => Promise<unknown>;
}) {
  const calls: { upsert: unknown[] } = { upsert: [] };
  const platform = {
    modules: {
      directory: {
        managedProfile: async () => behavior.managedProfile(),
        upsertProfile: async (_personId: number, input: unknown) => {
          calls.upsert.push(input);
          if (behavior.upsertProfile) return behavior.upsertProfile(input);
          return { profile: {}, publication: "published" };
        },
        submitClaim: async () => { throw new Error("not used in this test"); },
        myClaims: async () => ({ claims: [] }),
      },
    },
  };
  return { platform: platform as unknown as import("../../src/frontend-kit/domain/profileEditor").ProfileEditorPlatform, calls };
}

function managedView(profile: StoredProfile | null, permissions = REPRESENTATIVE) {
  return {
    profile: profile ?? { ...storedProfile(), row_version: 0, contact_value: null, published_at: null, publication_consent: false },
    permissions,
    current_province_scheme: "IR-3166-2:2024",
  };
}

async function waitFor<T>(probe: () => T, predicate: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = probe();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("waitFor: condition never met");
}

describe("N06 controller end-to-end — the representative journey", () => {
  it("publishes, updates and unpublishes with the stored row_version on every submission", async () => {
    const { platform, calls } = fakeDirectoryPlatform({ managedProfile: async () => managedView(storedProfile({ row_version: 5 })) });
    const controller = new ProfileEditorController();
    await controller.load({ platform, personId: 7 });
    expect(controller.getState().phase).toBe("ready");
    // Update the biography and submit — expected_version must be 5.
    controller.updateDraft((draft) => ({ ...draft, availability_text: "Weekend afternoons" }));
    await controller.submit();
    expect(calls.upsert).toHaveLength(1);
    expect((calls.upsert[0] as { expected_version?: number }).expected_version).toBe(5);
    await waitFor(() => controller.getState(), (s) => s.phase === "saved");
    // Unpublish (revoke consent) — an explicit representative choice.
    controller.updateDraft((draft) => ({ ...draft, publication_consent: false }));
    await controller.submit();
    expect((calls.upsert[1] as { publication_consent: boolean }).publication_consent).toBe(false);
  });

  it("first creation goes through the empty phase and submits without expected_version", async () => {
    const { platform, calls } = fakeDirectoryPlatform({ managedProfile: async () => managedView(null) });
    const controller = new ProfileEditorController();
    await controller.load({ platform, personId: 7 });
    expect(controller.getState().phase).toBe("empty");
    controller.updateDraft((draft) => ({ ...draft, service_categories: ["farrier"], publication_consent: true }));
    await controller.submit();
    expect("expected_version" in (calls.upsert[0] as object)).toBe(false);
  });

  it("a curator (no private contact) loads ready but never carries contact data", async () => {
    const { platform, calls } = fakeDirectoryPlatform({ managedProfile: async () => managedView(storedProfile(), CURATOR) });
    const controller = new ProfileEditorController();
    await controller.load({ platform, personId: 7 });
    expect(controller.getState().phase).toBe("ready");
    controller.updateDraft((draft) => ({ ...draft, city: "Shiraz" }));
    await controller.submit();
    expect("contact_value" in (calls.upsert[0] as object)).toBe(false);
  });

  it("409 conflict: fetches the current version, keeps the draft, blocks resubmission until explicit re-consent", async () => {
    let profile = storedProfile({ row_version: 3 });
    const { platform, calls } = fakeDirectoryPlatform({
      managedProfile: async () => managedView(profile),
      upsertProfile: async () => {
        // The server moved AND consent was withdrawn elsewhere.
        profile = storedProfile({ row_version: 4, publication_consent: false, city: "Qom" });
        throw new PlatformClientError(409, "profile_conflict", "Profile or representation changed.");
      },
    });
    const controller = new ProfileEditorController();
    await controller.load({ platform, personId: 7 });
    controller.updateDraft((draft) => ({ ...draft, city: "Karaj" }));
    await controller.submit();
    const conflicted = await waitFor(() => controller.getState(), (s) => s.phase === "conflict") as Extract<ReturnType<typeof controller.getState>, { phase: "conflict" }>;
    // The local draft is RETAINED (Karaj, consent still chosen locally).
    expect(conflicted.draft.city).toBe("Karaj");
    expect(conflicted.draft.publication_consent).toBe(true);
    // The current server state is fetched and diffed at field level.
    expect(conflicted.current.row_version).toBe(4);
    expect(conflicted.differences.map((d) => d.field)).toContain("city");
    expect(conflicted.differences.map((d) => d.field)).toContain("publication_consent");
    // Withdrawn consent blocks resubmission — NEVER auto-resubmitted.
    expect(conflicted.reconsentRequired).toBe(true);
    await controller.submit();
    expect(calls.upsert).toHaveLength(1); // blocked: nothing sent
    // Explicit re-consent unblocks the deliberate resubmission.
    controller.reconsentPublication();
    await controller.submit();
    expect(calls.upsert).toHaveLength(2);
    expect((calls.upsert[1] as { expected_version?: number }).expected_version).toBe(4);
  });

  it("409 without consent withdrawal resolves through retryWithCurrentVersion with the draft intact", async () => {
    let profile = storedProfile({ row_version: 2, city: "Tehran" });
    let refusedOnce = false;
    const { platform, calls } = fakeDirectoryPlatform({
      managedProfile: async () => managedView(profile),
      upsertProfile: async () => {
        if (!refusedOnce) {
          refusedOnce = true;
          profile = storedProfile({ row_version: 3, city: "Isfahan" });
          throw new PlatformClientError(409, "profile_conflict", "Profile or representation changed.");
        }
        return { profile: {}, publication: "published" };
      },
    });
    const controller = new ProfileEditorController();
    await controller.load({ platform, personId: 7 });
    controller.updateDraft((draft) => ({ ...draft, city: "Tabriz" }));
    await controller.submit();
    const conflicted = await waitFor(() => controller.getState(), (s) => s.phase === "conflict") as Extract<ReturnType<typeof controller.getState>, { phase: "conflict" }>;
    expect(conflicted.reconsentRequired).toBe(false);
    controller.retryWithCurrentVersion();
    expect(controller.getState().phase).toBe("ready");
    await controller.submit();
    // The retry carries the CURRENT version 3 and the RETAINED local draft.
    expect((calls.upsert[1] as { expected_version?: number; city?: string }).expected_version).toBe(3);
    expect((calls.upsert[1] as { city?: string }).city).toBe("Tabriz");
  });

  it("denied and unavailable are distinct honest states", async () => {
    const denied = fakeDirectoryPlatform({ managedProfile: async () => { throw new PlatformClientError(403, "directory_claim_required", "You need an approved claim"); } });
    const c1 = new ProfileEditorController();
    await c1.load({ platform: denied.platform, personId: 7 });
    expect(c1.getState().phase).toBe("denied");

    const unavailable = fakeDirectoryPlatform({ managedProfile: async () => { throw new Error("network offline"); } });
    const c2 = new ProfileEditorController();
    await c2.load({ platform: unavailable.platform, personId: 7 });
    expect(c2.getState().phase).toBe("unavailable");
  });
});

describe("N06 claim flow — statuses, rejection reasons, bounded appeals", () => {
  it("only the claimant's own REJECTED claims are appealable, once", () => {
    const summaries = summarizeClaims([
      { id: 1, status: "pending" },
      { id: 2, status: "rejected", review_note: "Evidence did not establish the link." },
      { id: 3, status: "rejected", appeal_for_claim_id: 2 },
      { id: 4, status: "approved" },
    ]);
    const byId = new Map(summaries.map((s) => [s.id, s]));
    expect(byId.get(1)!.appealable).toBe(false); // pending: nothing to appeal
    expect(byId.get(2)!.appealable).toBe(true); // rejected, not yet appealed
    expect(byId.get(3)!.appealable).toBe(false); // an appeal itself — bounded once
    expect(byId.get(4)!.appealable).toBe(false); // approved
    expect(byId.get(2)!.review_note).toBe("Evidence did not establish the link.");
  });
});

describe("N06 all five frontends bind the ONE shared controller", () => {
  const FRONTEND_EDITORS = [
    "src/web/heritage/ProfileWorkbench.tsx",
    "src/web/frontends/classic-registry/ProfileEditor.tsx",
    "src/web/frontends/equidata-elite/ProfileEditor.tsx",
    "src/web/frontends/fei-classic/ProfileEditor.tsx",
    "src/web/frontends/retro-astra/ProfileEditor.tsx",
  ];
  for (const editorPath of FRONTEND_EDITORS) {
    it(`${editorPath} imports the shared headless controller`, () => {
      const source = readFileSync(join(ROOT, editorPath), "utf8");
      expect(source).toContain("useProfileEditorController");
    });
  }
});
